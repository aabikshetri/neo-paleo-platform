export function taxonColor(name: string) {
  if (name === "Other" || name === "Unknown" || name === "No taxa data") {
    return "#94a3b8";
  }

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }

  return `hsl(${Math.abs(hash) % 360} 64% 48%)`;
}
