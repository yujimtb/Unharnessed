#!/usr/bin/env node

/**
 * Tiny task ordering experiment.
 *
 * Scores tasks by simple hints:
 * - smaller effort first
 * - urgent tasks earlier
 * - tasks containing setup/research/plan earlier
 * - tasks containing publish/share/review later
 */

const tasks = process.argv.slice(2);

if (tasks.length === 0) {
  console.log('Usage: node task-order.js "task one" "task two" "task three"');
  process.exit(0);
}

function score(task, index) {
  const text = task.toLowerCase();
  let points = index * 0.01; // stable-ish tie breaker

  if (/urgent|today|asap|deadline/.test(text)) points -= 3;
  if (/setup|prepare|outline|plan|research|gather/.test(text)) points -= 2;
  if (/draft|build|write|make|implement/.test(text)) points += 1;
  if (/review|polish|publish|share|send|deploy/.test(text)) points += 3;

  const effortMatch = text.match(/(\d+)\s*(min|minute|minutes|h|hr|hour|hours)/);
  if (effortMatch) {
    const amount = Number(effortMatch[1]);
    const minutes = /^h|^hr|^hour/.test(effortMatch[2]) ? amount * 60 : amount;
    points += minutes / 30;
  }

  return points;
}

const ordered = tasks
  .map((task, index) => ({ task, score: score(task, index) }))
  .sort((a, b) => a.score - b.score);

console.log('Suggested order:');
ordered.forEach((item, i) => {
  console.log(`${i + 1}. ${item.task}`);
});
