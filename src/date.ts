export function isValidDateFormat(dateString: string) {
  // Regular expression to match YYYY-MM-DD format
  const regex = /^\d{4}-\d{2}-\d{2}$/

  // Test if the string matches the pattern
  if (!regex.test(dateString)) {
    return false
  }

  // Optionally verify it's actually a valid date
  // by trying to parse it
  const parts = dateString.split('-')
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1 // Months are 0-based in JS
  const day = parseInt(parts[2], 10)

  const date = new Date(year, month, day)

  // Check if the date is valid and matches the input
  return (
    date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
  )
}
