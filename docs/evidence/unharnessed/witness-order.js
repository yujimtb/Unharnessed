#!/usr/bin/env node
// Contradictory variant: order tasks by 'witnesses' (characters) voting from the end backward.
const tasks = process.argv.slice(2);
if (!tasks.length) process.exit(console.log('Usage: node witness-order.js "task" ...'));

const ordered = tasks.map((text, i) => {
  const chars = [...text];
  const backwardVotes = chars.reduce((sum, ch, pos) => sum + ch.charCodeAt(0) * (chars.length - pos), 0);
  return { text, score: backwardVotes % 97, i };
}).sort((a, b) => b.score - a.score || a.i - b.i);

console.log('Witness order:');
ordered.forEach((t, n) => console.log(`${n + 1}. ${t.text} [witness score ${t.score}]`));
