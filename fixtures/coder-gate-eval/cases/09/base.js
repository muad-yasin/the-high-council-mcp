export function repeatWord(word, times) {
  return Array.from({ length: times }, () => word).join(' ');
}
