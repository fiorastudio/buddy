import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../db/schema.js';

// Verify voice mode and guard mode are orthogonal: setting one doesn't
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

describe('buddy_mode voice × guard orthogonality', () => {
  beforeEach(resetCompanions);

  it('setting voice does not affect guard_mode', () => {
    seed();
    db.prepare('UPDATE companions SET guard_mode = 1 WHERE id = ?').run('c1');
    db.prepare('UPDATE companions SET observer_mode = ? WHERE id = ?').run('skillcoach', 'c1');
    const row = db.prepare('SELECT observer_mode, guard_mode FROM companions WHERE id = ?').get('c1') as any;
    expect(row.observer_mode).toBe('skillcoach');
    expect(row.guard_mode).toBe(1);
  });

  it('setting guard does not affect voice', () => {
    seed();
    db.prepare('UPDATE companions SET observer_mode = ? WHERE id = ?').run('backseat', 'c1');
    db.prepare('UPDATE companions SET guard_mode = 0 WHERE id = ?').run('c1');
    db.prepare('UPDATE companions SET guard_mode = 1 WHERE id = ?').run('c1');
    const row = db.prepare('SELECT observer_mode, guard_mode FROM companions WHERE id = ?').get('c1') as any;
    expect(row.observer_mode).toBe('backseat');
    expect(row.guard_mode).toBe(1);
  });

  it('default values land right for a fresh companion', () => {
    seed('fresh');
    const row = db.prepare('SELECT observer_mode, guard_mode FROM companions WHERE id = ?').get('fresh') as any;
    expect(row.observer_mode).toBe('both');
    expect(row.guard_mode).toBe(0);
  });
});
