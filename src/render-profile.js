// Keep the phone's GPU budget for the road and moving vehicles.
export const mobileGraphics =
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export const renderProfile = {
  pixelRatio: mobileGraphics ? 1 : 1.5,
  antialias: !mobileGraphics,
  shadowSize: mobileGraphics ? 1024 : 2048,
  detailedFoliage: !mobileGraphics,
  leafCards: mobileGraphics ? 48 : 120,
  anisotropy: mobileGraphics ? 2 : 8,
};
