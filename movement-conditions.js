(function (root) {
  'use strict';
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const number = value => Number.isFinite(value);
  const allowed = (rule, value) => number(value) && (rule.requirement === 0 ? value > rule.position
    : rule.requirement === 1 ? value < rule.position
      : rule.requirement === 2 && number(rule.upperPosition) && value >= rule.position && value <= rule.upperPosition);
  const inRange = (value, min, max) => (min == null || value >= min) && (max == null || value <= max);

  function evaluate(model, order) {
    const plan = model?.movementConditions;
    const result = { error: null, steps: {}, positions: { ...(model?.startPositions || {}) } };
    const fail = (message, index) => {
      result.error = index == null ? message : `Schritt ${index + 1}: ${message}`;
      return result;
    };
    if (plan?.version !== 1 || !Array.isArray(plan.rules) || !plan.rules.length || !plan.axes || !plan.steps)
      return fail('Die Fahrtbedingungen sind unvollstaendig oder benoetigen eine neuere Version.');
    const specs = plan.steps, axes = Object.fromEntries(Object.entries(plan.axes).filter(([, value]) => value != null)), targets = model.targetPositions || {};
    if (!Object.keys(axes).length || !Number.isInteger(plan.maxBlocksPerCue) || plan.maxBlocksPerCue < 0
      || [plan.maxBlocksTotal, plan.maxBlockedSteps].some(value => value != null && (!Number.isInteger(value) || value < 0)))
      return fail('Die gespeicherten Sperrgrenzen oder Achsen sind ungueltig.');
    const ids = Object.keys(specs);
    if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length
      || order.some(id => !own(specs, id))) return fail('Die Sortierung passt nicht zur veroeffentlichten Sequenz. Bitte neu laden.');
    const same = (id, a, b) => number(a) && number(b) && Math.abs(a / axes[id].scale - b / axes[id].scale) <= axes[id].tolerance;
    const format = (id, value) => number(value) ? String(value / (axes[id]?.scale || 1)).replace('.', ',') : '?';
    const label = id => axes[id]?.name || String(id);
    for (const [id, axis] of Object.entries(axes)) {
      if (![1, 10].includes(axis.scale) || !number(axis.tolerance) || axis.tolerance < 0
        || (own(targets, id) && (!number(targets[id]) || !number(result.positions[id]))))
        return fail(`Fuer ${label(id)} fehlen gueltige Positionsdaten.`);
    }
    for (const rule of plan.rules) {
      if (![0, 1].includes(rule.trigger) || ![0, 1, 2].includes(rule.direction) || ![0, 1, 2].includes(rule.requirement)
        || !own(axes, rule.requiredAxisId) || !number(rule.position)
        || (rule.trigger === 0 && (!own(axes, rule.movingAxisId) || rule.movingAxisId === rule.requiredAxisId))
        || (rule.trigger === 1 && !number(rule.cueId))
        || (rule.requirement === 2 && (!number(rule.upperPosition) || rule.upperPosition < rule.position))
        || [rule.fromMinimum, rule.fromMaximum, rule.toMinimum, rule.toMaximum].some(value => value != null && !number(value))
        || (rule.fromMinimum != null && rule.fromMaximum != null && rule.fromMinimum > rule.fromMaximum)
        || (rule.toMinimum != null && rule.toMaximum != null && rule.toMinimum > rule.toMaximum))
        return fail('Eine Fahrtbedingung enthaelt ungueltige Angaben. Bitte am PC pruefen.');
    }
    const preparationAxes = new Set(plan.rules.map(r => String(r.requiredAxisId)));
    const blockedEarlier = new Set();
    let totalBlocks = 0, blockedSteps = 0;
    for (let index = 0; index < order.length; index++) {
      const id = order[index], step = specs[id];
      const state = { rows: [], blocked: [], unblocked: [], affected: [], covered: [] };
      result.steps[id] = state;
      if (step.disabled) continue;
      const blocks = new Set((step.blockedAxisIds || []).map(String));
      if (step.blockCount !== blocks.size || !Number.isInteger(plan.maxBlocksPerCue) || plan.maxBlocksPerCue < 0)
        return fail('Die gespeicherten Sperren fehlen oder sind ungueltig.', index);
      let actions;
      if (step.kind === 'manual') {
        if (!own(axes, step.axisId) || !number(targets[step.axisId]) || blocks.size)
          return fail('Die Positionsfahrt ist unvollstaendig.', index);
        actions = { [step.axisId]: targets[step.axisId] };
      } else if (step.kind === 'cue') {
        const cue = model.cueActions?.[step.cueId];
        if (!cue || !Object.keys(cue).length) return fail('Positionsdaten des Cues fehlen.', index);
        if ([...blocks].some(axis => !own(cue, axis))) return fail('Eine Sperre passt nicht zum Cue.', index);
        totalBlocks += blocks.size;
        if (blocks.size) blockedSteps++;
        if (blocks.size > plan.maxBlocksPerCue || (plan.maxBlocksTotal != null && totalBlocks > plan.maxBlocksTotal)
          || (plan.maxBlockedSteps != null && blockedSteps > plan.maxBlockedSteps))
          return fail('Die erlaubte Anzahl an Sperren wird ueberschritten.', index);
        actions = Object.fromEntries(Object.entries(cue).filter(([axis]) => own(axes, axis))
          .map(([axis, act]) => [axis, step.backward ? act.s : act.e]));
      } else return fail('Unbekannte Fahrtart.', index);
      const next = Object.fromEntries(Object.entries(actions).filter(([axis]) => !blocks.has(axis)));
      if (Object.entries(next).some(([axis, value]) => !number(value) || !number(result.positions[axis]) || !number(targets[axis])))
        return fail('Fuer eine bewegte Achse fehlen Start- oder Zielpositionen.', index);
      for (const rule of plan.rules) {
        const from = result.positions[rule.movingAxisId], to = next[rule.movingAxisId];
        const applies = rule.trigger === 1
          ? step.kind === 'cue' && step.cueId === rule.cueId && (rule.direction === 0 || (rule.direction === 2) === step.backward)
          : own(next, rule.movingAxisId) && (!number(from) || from !== to
            && inRange(from, rule.fromMinimum, rule.fromMaximum) && inRange(to, rule.toMinimum, rule.toMaximum));
        if (!applies) continue;
        const requirement = `Fahrtbedingung "${rule.name}": ${label(rule.requiredAxisId)}`;
        if (!allowed(rule, result.positions[rule.requiredAxisId]))
          return fail(`${requirement} steht vor Beginn der Fahrt nicht im erlaubten Bereich.`, index);
        if (own(next, rule.requiredAxisId) && !allowed(rule, next[rule.requiredAxisId]))
          return fail(`${requirement} verlaesst im selben Schritt den erlaubten Bereich.`, index);
      }
      for (const [axis, end] of Object.entries(actions)) {
        const start = result.positions[axis], target = targets[axis], blocked = blocks.has(axis);
        const moving = !blocked && start !== end;
        if (!blocked && !preparationAxes.has(axis) && same(axis, start, target) && !same(axis, end, target))
          return fail(`${label(axis)} wuerde ohne Sperre die bereits erreichte Zielposition verlassen.`, index);
        const preparation = moving && !same(axis, end, target)
          && plan.rules.some(rule => String(rule.requiredAxisId) === axis && allowed(rule, end));
        let status, kind;
        if (blocked) {
          status = `Achse sperren. Cue wuerde von ${format(axis, start)} nach ${format(axis, end)} fahren.`;
          kind = 'BewegtWegVonZiel';
          state.blocked.push(Number(axis));
        } else if (preparation) {
          status = `Vorbereitung fuer Fahrtbedingungen: von ${format(axis, start)} auf ${format(axis, end)}. Ziel am Ende: ${format(axis, target)}.`;
          kind = 'Vorbereitung';
        } else if (moving) {
          status = `Achse faehrt von ${format(axis, start)} nach ${format(axis, end)}.`;
          kind = same(axis, end, target) ? 'BringtAufZiel' : 'SonstigeBewegung';
        } else {
          status = `Achse bleibt auf ${format(axis, start)}.`;
          kind = 'KeineBewegung';
        }
        const unblock = moving && blockedEarlier.has(axis);
        if (unblock) { state.unblocked.push(Number(axis)); blockedEarlier.delete(axis); }
        if (moving) state.affected.push(Number(axis));
        if (moving && same(axis, end, target) && !same(axis, start, target)) state.covered.push(Number(axis));
        state.rows.push({ axisId: Number(axis), start, target: preparation ? end : target, end,
          status, kind, notice: unblock ? 'Vor dieser Fahrt entsperren.' : '', preparation });
      }
      for (const axis of blocks) blockedEarlier.add(axis);
      Object.assign(result.positions, next);
    }
    for (const axis of Object.keys(axes))
      if (own(targets, axis) && !same(axis, result.positions[axis], targets[axis]))
        return fail(`Die Zielposition von ${label(axis)} wird nicht erreicht.`);
    return result;
  }
  const api = { evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PHMovementConditions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
