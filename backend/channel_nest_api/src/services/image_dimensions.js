const Ratios = {
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '16:9': [16, 9],
  '9:16': [9, 16],
};

const OutputLongEdge = { '1k': 1024, '2k': 2048, '4k': 4096 };
const ProviderLongEdge = { '1k': 1024, '2k': 2048, '4k': 3840 };
const ProviderAlignment = 16;
const ProviderMinPixels = 655360;
const ProviderMaxPixels = 8294400;

function resolveDimensions(resolution, aspectRatio) {
  const ratio = Ratios[aspectRatio];
  const edge = OutputLongEdge[resolution];
  if (!ratio || !edge) return null;
  const landscape = ratio[0] >= ratio[1];
  const width = landscape ? edge : Math.round((edge * ratio[0]) / ratio[1]);
  const height = landscape ? Math.round((edge * ratio[1]) / ratio[0]) : edge;

  return { width, height };
}

function providerSize(resolution, aspectRatio) {
  const ratio = Ratios[aspectRatio];
  const edge = ProviderLongEdge[resolution];
  if (!ratio || !edge) return null;
  const longRatio = Math.max(...ratio);
  const pixelsPerStep = ratio[0] * ratio[1] * (ProviderAlignment ** 2);
  const desiredStep = Math.floor(edge / (longRatio * ProviderAlignment));
  const minimumStep = Math.ceil(Math.sqrt(ProviderMinPixels / pixelsPerStep));
  const maximumStep = Math.floor(Math.sqrt(ProviderMaxPixels / pixelsPerStep));
  const step = Math.max(minimumStep, Math.min(desiredStep, maximumStep));
  const width = ratio[0] * ProviderAlignment * step;
  const height = ratio[1] * ProviderAlignment * step;

  return `${width}x${height}`;
}

module.exports = { providerSize, resolveDimensions };
