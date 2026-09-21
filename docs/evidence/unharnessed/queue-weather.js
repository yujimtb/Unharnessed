#!/usr/bin/env node
// Tiny visual forecast for the queue. Not the main sorter, just a runnable omen.
const tasks = process.argv.slice(2);
if (!tasks.length) process.exit(console.log('Usage: node queue-weather.js "task" ...'));
const icons = ['☁', '↯', '✓', '…', '→'];
console.log('Queue weather:');
tasks.forEach((t, i) => {
  const pressure = ([...t].reduce((a, c) => a + c.charCodeAt(0), 0) + i) % icons.length;
  console.log(`${icons[pressure]} ${t}`);
});
