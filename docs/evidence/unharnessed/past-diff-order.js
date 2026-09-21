#!/usr/bin/env node
// Another tiny variant: each task invents a desired past, then conflicts pick the present order.
const tasks = process.argv.slice(2);
if (!tasks.length) process.exit(console.log('Usage: node past-diff-order.js "task" ...'));

const wishes = tasks.map((text, i) => {
  const wantsAlreadyDone = /\b(done|finish|send|pay|fix)\b/i.test(text) ? 7 : 0;
  const regretIfLate = /\b(today|urgent|call|deadline)\b/i.test(text) ? 9 : 0;
  const memoryBlur = Math.min(5, text.length % 6);
  return { text, i, conflict: wantsAlreadyDone + regretIfLate - memoryBlur };
}).sort((a, b) => b.conflict - a.conflict || a.i - b.i);

console.log('Order from desired-past conflicts:');
wishes.forEach((t, n) => console.log(`${n + 1}. ${t.text} [conflict ${t.conflict}]`));
