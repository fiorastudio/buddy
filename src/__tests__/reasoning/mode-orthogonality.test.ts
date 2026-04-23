import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../db/schema.js';

// Verify voice mode and max mode are orthogonal: setting one doesn't
// change the other. Uses direct SQL rather than invoking the MCP handler
// (to avoid stdio/transport setup), mirroring what the handler does.

function resetCompanions() {
  db.exec(`DELETE FROM companions;`);
}

function seed(id = 'c1'): void {
  db.prepare(
    `INSERT INTO companions (id, name, species, user_id, personality_bio) VALUES (?, 'T', 'Mushroom', 'u', 'b')`
  ).run(id);
}

describe('buddy_mode voice × max orthogonality', () => {
  beforeEach(resetCompanions);

  it('setting voice does not affect max_mode', () => {
    seed();
    db.prepare('UPDATE companions SET max_mode = 1 WHERE id = ?').run('c1');
    db.prepare('UPDATE companions SET observer_mode = ? WHERE id = ?').run('skillcoach', 'c1');
    const row = db.prepare('SELECT observer_mode, max_mode FROM companions WHERE id = ?').get('c1') as any;
    expect(row.observer_mode).toBe('skillcoach');
    expect(row.max_mode).toBe(1);
  });

  it('setting max does not affect voice', () => {
    seed();
    db.prepare('UPDATE companions SET observer_mode = ? WHERE id = ?').run('backseat', 'c1');
    db.prepare('UPDATE companions SET max_mode = 0 WHERE id = ?').run('c1');
    db.prepare('UPDATE companions SET max_mode = 1 WHERE id = ?').run('c1');
    const row = db.prepare('SELECT observer_mode, max_mode FROM companions WHERE id = ?').get('c1') as any;
    expect(row.observer_mode).toBe('backseat');
    expect(row.max_mode).toBe(1);
  });

  it('default values land right for a fresh companion', () => {
    seed('fresh');
    const row = db.prepare('SELECT observer_mode, max_mode FROM companions WHERE id = ?').get('fresh') as any;
    // observer_mode column was added with DEFAULT 'both'; max_mode DEFAULT 0.
    expect(row.observer_mode).toBe('both');
    expect(row.max_mode).toBe(0);
  });
});
