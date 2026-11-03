-- Hand-written migration: "every ai_impact has at least one source", enforced
-- by the database itself.
--
-- Why a trigger. The product constraint (ZCZ-4) is that a record cannot exist
-- without a source, and that it must be blocked at three layers: form, server
-- action, and database. The first two are in `src/lib/records/`. At the database
-- layer a foreign key is the wrong tool — it guarantees every source points at
-- a real impact, which is the opposite direction. "At least one child" needs a
-- constraint trigger.
--
-- Why DEFERRABLE INITIALLY DEFERRED. The impact row has to exist before its
-- sources can reference it, so for one instant mid-transaction every new record
-- legitimately has zero sources. A deferred constraint trigger fires at COMMIT
-- instead of per statement, so a single transaction that inserts an impact and
-- then its sources passes, while a transaction that commits an impact with no
-- sources is rolled back. The application always writes both in one
-- transaction; see `saveRecord` in src/lib/records/store.ts.
--
-- Everything below is written to be re-runnable: the drizzle migrator only
-- applies a file once, but `npm run db:migrate` against a hand-patched database
-- should still converge rather than error.

CREATE OR REPLACE FUNCTION ai_impact_requires_source() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- The row may have been deleted later in the same transaction (e.g. the
  -- company was removed, cascading). Nothing to assert in that case.
  IF NOT EXISTS (SELECT 1 FROM ai_impact WHERE id = NEW.id) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM source WHERE ai_impact_id = NEW.id) THEN
    RAISE EXCEPTION
      'ai_impact % has no source row; every record requires at least one source', NEW.id
      USING ERRCODE = 'integrity_constraint_violation',
            HINT = 'Insert the source rows in the same transaction as the ai_impact row.';
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Deleting a source is the other way to reach zero. Separate function because
-- plpgsql resolves OLD/NEW field references when it plans the statement, so one
-- function cannot read both records.
CREATE OR REPLACE FUNCTION source_delete_requires_remaining() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- Deleting the impact itself cascades to its sources; that is not a record
  -- losing its evidence, so only assert while the parent still exists.
  IF NOT EXISTS (SELECT 1 FROM ai_impact WHERE id = OLD.ai_impact_id) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM source WHERE ai_impact_id = OLD.ai_impact_id) THEN
    RAISE EXCEPTION
      'ai_impact % would be left with no source row; every record requires at least one source',
      OLD.ai_impact_id
      USING ERRCODE = 'integrity_constraint_violation',
            HINT = 'Delete the ai_impact row instead, or add a replacement source first.';
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS ai_impact_requires_source_trigger ON ai_impact;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ai_impact_requires_source_trigger
  AFTER INSERT OR UPDATE ON ai_impact
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_impact_requires_source();
--> statement-breakpoint

DROP TRIGGER IF EXISTS source_delete_requires_remaining_trigger ON source;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER source_delete_requires_remaining_trigger
  AFTER DELETE ON source
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION source_delete_requires_remaining();
