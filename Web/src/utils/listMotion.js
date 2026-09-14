// Freeze the outgoing card's geometry before Vue moves the remaining items.
// Clearing on cancellation matters when a quick filter change restores a card.
const previousStyles = new WeakMap()
const geometry = ['width', 'height', 'left', 'top']

export const prepareListLeave = (element) => {
  if (!previousStyles.has(element)) previousStyles.set(element, {
    styles: Object.fromEntries(geometry.map(property => [property, element.style[property]])),
    inert: element.inert,
  })
  element.style.width = `${element.offsetWidth}px`
  element.style.height = `${element.offsetHeight}px`
  element.style.left = `${element.offsetLeft}px`
  element.style.top = `${element.offsetTop}px`
  element.inert = true
}

export const clearListLeave = (element) => {
  const previous = previousStyles.get(element)
  if (!previous) return
  for (const property of geometry) element.style[property] = previous.styles[property]
  element.inert = previous.inert
  previousStyles.delete(element)
}
