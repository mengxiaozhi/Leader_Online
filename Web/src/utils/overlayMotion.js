export const projectPosition = (position, velocity, projectionSeconds = 0.2) => {
  const safePosition = Number.isFinite(Number(position)) ? Number(position) : 0
  const safeVelocity = Number.isFinite(Number(velocity)) ? Number(velocity) : 0
  const safeProjection = Math.max(0, Number(projectionSeconds) || 0)
  return safePosition + safeVelocity * safeProjection
}

export const rubberBand = (distance, dimension, coefficient = 0.55) => {
  const safeDistance = Number.isFinite(Number(distance)) ? Number(distance) : 0
  const safeDimension = Math.max(1, Number(dimension) || 1)
  const safeCoefficient = Math.max(0, Number(coefficient) || 0)
  const magnitude = Math.abs(safeDistance)
  const resisted = (safeCoefficient * magnitude * safeDimension) / (safeDimension + safeCoefficient * magnitude)
  return Math.sign(safeDistance) * resisted
}

export const shouldDismissOverlay = ({ offset = 0, velocity = 0, size = 1 } = {}) => {
  const safeSize = Math.max(1, Number(size) || 1)
  const projected = projectPosition(Math.max(0, Number(offset) || 0), Number(velocity) || 0)
  const distanceThreshold = Math.max(96, safeSize * 0.34)
  return (Number(velocity) || 0) > 1100 || projected >= distanceThreshold
}
