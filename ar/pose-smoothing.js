import * as THREE from "three";

/**
 * MindAR overwrites the anchor's matrix from a fresh homography estimate on
 * every tracked frame, with no smoothing of its own. Frame-to-frame that
 * noise is only a pixel or two — invisible comparing two stills — but the
 * eye is very sensitive to a rigid overlay trembling against the real world
 * it's supposed to be locked to, so it reads as "flicker" even though
 * nothing is actually blinking on or off.
 *
 * This smooths the tracked pose with an exponential moving average before
 * it reaches the anchor's render transform: each update nudges the
 * rendered position/rotation partway toward the new raw estimate instead of
 * snapping straight to it. Trades a small amount of latency for a stable
 * image — tune `smoothing` down for less jitter (more lag) or up for less
 * lag (more jitter).
 */
export function smoothAnchorPose(anchor, smoothing = 0.3) {
  const rawPos = new THREE.Vector3();
  const rawQuat = new THREE.Quaternion();
  const rawScale = new THREE.Vector3();
  const smoothedPos = new THREE.Vector3();
  const smoothedQuat = new THREE.Quaternion();
  let initialized = false;

  const originalOnTargetUpdate = anchor.onTargetUpdate;
  anchor.onTargetUpdate = () => {
    if (anchor.group.visible) {
      anchor.group.matrix.decompose(rawPos, rawQuat, rawScale);
      if (!initialized) {
        // First frame after (re)acquiring the target: snap straight to the
        // real pose rather than easing in from a stale or default one.
        smoothedPos.copy(rawPos);
        smoothedQuat.copy(rawQuat);
        initialized = true;
      } else {
        smoothedPos.lerp(rawPos, smoothing);
        smoothedQuat.slerp(rawQuat, smoothing);
      }
      anchor.group.matrix.compose(smoothedPos, smoothedQuat, rawScale);
    }
    originalOnTargetUpdate?.();
  };

  const originalOnTargetLost = anchor.onTargetLost;
  anchor.onTargetLost = () => {
    initialized = false;
    originalOnTargetLost?.();
  };
}
