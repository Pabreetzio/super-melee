import {
  applyInertialThrust,
  setVelocityComponents,
  WORLD_TO_VELOCITY,
  type VelocityDesc,
} from '../src/engine/velocity';

function velocity(vx = 0, vy = 0): VelocityDesc {
  const v: VelocityDesc = { travelAngle: 0, vx: 0, vy: 0, ex: 0, ey: 0 };
  setVelocityComponents(v, vx, vy);
  return v;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const maxThrust = 30;
const thrustIncrement = 6;

{
  const v = velocity(WORLD_TO_VELOCITY(12), 0);
  applyInertialThrust(v, 4, maxThrust, thrustIncrement, false);
  assert(v.vx > WORLD_TO_VELOCITY(12), 'under max thrust should accelerate normally');
}

{
  const v = velocity(WORLD_TO_VELOCITY(50), 0);
  const before = v.vx;
  const status = applyInertialThrust(v, 12, maxThrust, thrustIncrement, false);
  assert(v.vx < before, 'over max counter-thrust should still reduce speed');
  assert(status.atMax && status.beyondMax, 'over max deceleration should report beyond-max status');
}

{
  const v = velocity(WORLD_TO_VELOCITY(50), 0);
  const beforeX = v.vx;
  const status = applyInertialThrust(v, 0, maxThrust, thrustIncrement, false);
  assert(v.vx < beforeX, 'over max angled thrust should bleed current travel vector');
  assert(v.vy < 0, 'over max angled thrust should add half thrust toward facing');
  assert(status.atMax && status.beyondMax, 'over max angled thrust should report beyond-max status');
}

{
  const v = velocity(WORLD_TO_VELOCITY(30), 0);
  const beforeX = v.vx;
  const status = applyInertialThrust(
    v,
    4,
    maxThrust,
    thrustIncrement,
    false,
    { atMax: true, beyondMax: false },
  );
  assert(v.vx === beforeX, 'already maxed same-vector thrust should not change velocity');
  assert(status.atMax && !status.beyondMax, 'already maxed same-vector thrust should preserve max status');
}

console.log('inertial thrust regression checks passed');
