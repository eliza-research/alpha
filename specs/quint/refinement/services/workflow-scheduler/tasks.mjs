import {deferred} from '../support.mjs';

/** Primitive task persistence. All schedule selection, binding and cleanup stay in the real service. */
export function taskStore() {
  const tasks = new Map();
  const events = [];
  const openCreates = new Map();
  const gates = {};
  let nextId = 0;
  const port = {
    async getTasks() {
      if (gates.read) await gates.read.promise;
      return structuredClone([...tasks.values()]);
    },
    async getTasksByName(name) {
      return structuredClone([...tasks.values()].filter(task => task.name === name));
    },
    async createTask(input) {
      const id = `task-${++nextId}`;
      events.push({kind: 'create-called', id, input: structuredClone(input)});
      openCreates.set(id, structuredClone(input));
      try {
        if (gates.beforeCreate) await gates.beforeCreate.promise;
        tasks.set(id, {id, ...structuredClone(input)});
        events.push({kind: 'created', id});
        if (gates.afterCreate) await gates.afterCreate.promise;
        return id;
      } finally { openCreates.delete(id); }
    },
    async deleteTask(id) {
      events.push({kind: 'delete-called', id});
      if (gates.beforeDelete) await gates.beforeDelete.promise;
      tasks.delete(id);
      events.push({kind: 'deleted', id});
      if (gates.afterDelete) await gates.afterDelete.promise;
    },
  };
  return {
    port, tasks, events, openCreates,
    seed(input) { const id = `task-${++nextId}`; tasks.set(id, {id, ...structuredClone(input)}); return id; },
    detach(stage) { const gate = gates[stage]; delete gates[stage]; return gate; },
    hold(stage) { const gate = deferred(); gates[stage] = gate; return gate; },
    release(stage) { const gate = gates[stage]; delete gates[stage]; gate.resolve(); },
    fail(stage, message = 'Task persistence unavailable') { const gate = gates[stage]; delete gates[stage]; gate.reject(Error(message)); },
  };
}
