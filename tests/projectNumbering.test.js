const test = require('node:test');
const assert = require('node:assert/strict');

async function loadAdapter() {
  return import('../adapters/quoteCore/supabaseQuoteProjectAdapter.js');
}

function makeInsertChain(onInsert) {
  return {
    insert(row) {
      onInsert(row);
      return {
        select() {
          return {
            single() {
              return Promise.resolve({ data: row, error: null });
            }
          };
        }
      };
    }
  };
}

test('createProject reserva número transaccional cuando falta project_number', async () => {
  const rpcCalls = [];
  let insertedRow;
  const supabase = {
    from(table) {
      assert.equal(table, 'elankav_projects');
      return makeInsertChain((row) => { insertedRow = row; });
    },
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: 'PRY-2026-000016', error: null });
    }
  };
  const { SupabaseQuoteProjectAdapter } = await loadAdapter();
  const adapter = new SupabaseQuoteProjectAdapter({ supabase });

  const result = await adapter.createProject({
    id: 'project-id',
    quotation_id: 'quotation-id',
    project_number: null,
    created_at: '2026-07-18T12:00:00.000Z'
  });

  assert.deepEqual(rpcCalls, [{
    name: 'elankav_reserve_project_number',
    params: { target_year: 2026 }
  }]);
  assert.equal(insertedRow.project_number, 'PRY-2026-000016');
  assert.equal(result.project_number, 'PRY-2026-000016');
});

test('createProject conserva un número explícito y no consume correlativo', async () => {
  let rpcCalled = false;
  let insertedRow;
  const supabase = {
    from() {
      return makeInsertChain((row) => { insertedRow = row; });
    },
    rpc() {
      rpcCalled = true;
      return Promise.resolve({ data: 'PRY-2026-999999', error: null });
    }
  };
  const { SupabaseQuoteProjectAdapter } = await loadAdapter();
  const adapter = new SupabaseQuoteProjectAdapter({ supabase });

  await adapter.createProject({
    id: 'project-id',
    project_number: 'PRY-2026-000015'
  });

  assert.equal(rpcCalled, false);
  assert.equal(insertedRow.project_number, 'PRY-2026-000015');
});

test('reserveProjectNumber rechaza respuestas que no cumplen el contrato', async () => {
  const supabase = {
    from() {},
    rpc() {
      return Promise.resolve({ data: 'PROJECT-16', error: null });
    }
  };
  const { SupabaseQuoteProjectAdapter } = await loadAdapter();
  const adapter = new SupabaseQuoteProjectAdapter({ supabase });

  await assert.rejects(
    adapter.reserveProjectNumber({ createdAt: '2026-07-18T12:00:00.000Z' }),
    (error) => error.code === 'PROJECT_NUMBER_INVALID'
  );
});
