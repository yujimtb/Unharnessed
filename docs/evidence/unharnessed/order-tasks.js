#!/usr/bin/env node
// Tiny task-order suggester: scores each task like a small weather report.
// Usage: node order-tasks.js "task one" "task two" "task three"

const tasks = process.argv.slice(2);

if (tasks.length === 0) {
  console.log('Usage: node order-tasks.js "clear inbox" "draft note" "stretch"');
  process.exit(1);
}

const urgencyWords = /\b(now|urgent|today|deadline|soon|fix|pay|call|send)\b/i;
const quickWords = /\b(tiny|quick|small|short|draft|skim|check)\b/i;
const heavyWords = /\b(research|deep|long|major|plan|rewrite|build)\b/i;

function scoreTask(text, index) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const urgent = urgencyWords.test(text) ? 8 : 0;
  const quick = quickWords.test(text) ? 3 : 0;
  const heavy = heavyWords.test(text) ? -2 : 0;
  const shortness = Math.max(0, 6 - words);
  const tieBreaker = (tasks.length - index) / 100;

  return urgent + quick + heavy + shortness + tieBreaker;
}

const ordered = tasks
  .map((text, index) => ({ text, index, score: scoreTask(text, index) }))
  .sort((a, b) => b.score - a.score);

console.log('Suggested order:');
ordered.forEach((task, i) => {
  const weather = task.score >= 10 ? 'thunderbolt' : task.score >= 6 ? 'tailwind' : 'calm';
  console.log(`${i + 1}. ${task.text}  [${weather}, score ${task.score.toFixed(2)}]`);
});
