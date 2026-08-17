import * as THREE from 'three';
import { L } from '../world/Layout';
import type { AABB, Station } from '../world/Station';
import type { Input } from '../core/Input';
import type { Settings } from '../core/Settings';

const WALK = 1.62;
const RUN = 2.72;
const ACCEL = 11;
const DECEL = 14;
const MAX_PITCH = Math.PI / 2 - 0.03;

/**
 * First-person controller.
 *
 * Deliberately conservative: no jump, no crouch, no sprint-bob. The camera does
 * almost nothing the player did not ask for, because every unrequested camera
 * movement in a horror game costs comfort without buying tension.
 */
export class Player {
  readonly position = new THREE.Vector3(L.SPAWN_X, L.DECK_Y, L.SPAWN_Z);
  /** Camera yaw. Forward is (-sin yaw, -cos yaw); -PI/2 faces +X down the platform. */
  yaw = -Math.PI / 2;
  pitch = 0;

  private velocity = new THREE.Vector2();
  private bobPhase = 0;
  private bobAmount = 0;
  private stepDistance = 0;
  private lean = 0;
  frozen = false;

  onFootstep: ((running: boolean) => void) | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private input: Input,
    private settings: Settings,
    private station: Station,
  ) {}

  reset(x = L.SPAWN_X, z = L.SPAWN_Z, yaw = -Math.PI / 2): void {
    this.position.set(x, this.station.floorHeightAt(x, z), z);
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0);
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.lean = 0;
    this.applyCamera(0);
  }

  get speed(): number {
    return this.velocity.length();
  }

  update(dt: number): void {
    const look = this.input.consumeLook();
    this.yaw += look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -MAX_PITCH, MAX_PITCH);

    if (this.frozen) {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 8));
    } else {
      this.integrate(dt);
    }
    this.applyCamera(dt);
  }

  private integrate(dt: number): void {
    const wish = new THREE.Vector2(this.input.move.x, this.input.move.y);
    if (wish.lengthSq() > 1) wish.normalize();

    const target = new THREE.Vector2();
    if (wish.lengthSq() > 0.0001) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // forward = (-sin, -cos), right = (cos, -sin) — matches the camera basis
      const fx = -sin * wish.y;
      const fz = -cos * wish.y;
      const rx = cos * wish.x;
      const rz = -sin * wish.x;
      target.set(fx + rx, fz + rz);
      const max = this.input.run ? RUN : WALK;
      // strafing and backing up are a touch slower — reads as careful walking
      const dirPenalty = wish.y < -0.1 ? 0.78 : 1;
      target.setLength(max * dirPenalty * Math.min(1, wish.length()));
    }

    const rate = target.lengthSq() > 0.0001 ? ACCEL : DECEL;
    this.velocity.lerp(target, Math.min(1, rate * dt));
    if (this.velocity.lengthSq() < 0.0004) this.velocity.set(0, 0);

    const next = new THREE.Vector2(
      this.position.x + this.velocity.x * dt,
      this.position.z + this.velocity.y * dt,
    );
    this.resolveCollisions(next);
    this.position.x = next.x;
    this.position.z = next.y;

    // follow the floor (stairs) smoothly
    const targetY = this.station.floorHeightAt(this.position.x, this.position.z);
    this.position.y += (targetY - this.position.y) * Math.min(1, dt * 14);

    // footsteps by distance travelled, not by timer
    const dist = this.velocity.length() * dt;
    this.stepDistance += dist;
    const stride = this.input.run ? 0.82 : 0.68;
    if (this.stepDistance > stride) {
      this.stepDistance = 0;
      this.onFootstep?.(this.input.run && this.velocity.length() > WALK + 0.2);
    }
  }

  private resolveCollisions(next: THREE.Vector2): void {
    const r = L.PLAYER_RADIUS;
    // Colliders live in the station's local space; one anomaly scales the whole
    // platform along X, so test in local space and convert back afterwards.
    const s = this.station.stretch;
    next.x /= s;
    for (const b of this.station.colliders as AABB[]) {
      const cx = THREE.MathUtils.clamp(next.x, b.minX, b.maxX);
      const cz = THREE.MathUtils.clamp(next.y, b.minZ, b.maxZ);
      const dx = next.x - cx;
      const dz = next.y - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;

      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        next.x += (dx / d) * (r - d);
        next.y += (dz / d) * (r - d);
      } else {
        // centre is inside the box: push out along the shallowest axis
        const toLeft = next.x - b.minX;
        const toRight = b.maxX - next.x;
        const toBack = next.y - b.minZ;
        const toFront = b.maxZ - next.y;
        const m = Math.min(toLeft, toRight, toBack, toFront);
        if (m === toLeft) next.x = b.minX - r;
        else if (m === toRight) next.x = b.maxX + r;
        else if (m === toBack) next.y = b.minZ - r;
        else next.y = b.maxZ + r;
      }
    }

    // hard bounds so the player can never leave the level
    next.x = THREE.MathUtils.clamp(next.x, -L.STAIR_END + 0.3, L.STAIR_END - 0.3);
    next.y = THREE.MathUtils.clamp(next.y, L.WALL_Z + 0.35, L.EDGE_Z + 0.4);
    next.x *= s;
  }

  private applyCamera(dt: number): void {
    const sp = this.velocity.length();
    const moving = sp > 0.12;

    // Head bob: tiny by design. settings.bob scales it, 0 disables entirely.
    const bobScale = this.settings.data.bob;
    this.bobPhase += dt * (sp * 3.6);
    this.bobAmount += ((moving ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 6);
    const bobY = Math.sin(this.bobPhase * 2) * 0.021 * this.bobAmount * bobScale;
    const bobX = Math.sin(this.bobPhase) * 0.016 * this.bobAmount * bobScale;

    // barely-there roll when strafing
    const targetLean = -this.input.move.x * 0.012 * bobScale;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 5);

    this.camera.position.set(
      this.position.x + bobX * Math.cos(this.yaw),
      this.position.y + L.EYE_HEIGHT + bobY,
      this.position.z - bobX * Math.sin(this.yaw),
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    this.camera.rotateZ(this.lean);
  }

  /** Forward vector in the XZ plane. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
