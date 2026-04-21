-- fleet_device_health: append-only nightly health snapshot, one row per device per night.
-- RLS mirrors fleet_servers: user_has_product_access('it') AND organization_id = get_user_organization_id().
-- Windows-specific columns stay explicit at top level; non-Windows rows leave them NULL (phase 2).

BEGIN;

CREATE TABLE public.fleet_device_health (
    id                               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                  uuid         NOT NULL,
    fleet_server_id                  uuid         REFERENCES public.fleet_servers(id)          ON DELETE CASCADE,
    fleet_device_hardware_id         uuid         REFERENCES public.fleet_device_hardware(id)  ON DELETE SET NULL,
    mesh_node_id                     text         NOT NULL,
    hostname                         text         NOT NULL,
    device_type                      text         NOT NULL DEFAULT 'windows_till'
                                                   CHECK (device_type IN ('windows_till')),

    captured_at                      timestamptz  NOT NULL,

    uptime_hours                     numeric(10,2),
    free_space_pct                   numeric(5,2),

    -- per-disk: [{ friendly_name, health_status, operational_status, media_type,
    --             predict_failure (bool|null), reason_code (int|null) }]
    smart_status                     jsonb,

    -- [{ time_created (iso), bugcheck_code (text), bugcheck_text (text) }]
    bsods_30d                        jsonb,
    bsods_90d_count                  integer,

    unexpected_shutdowns_30d_count   integer,

    -- [{ process (text), count (int) }] top-20 by count desc
    service_crashes_7d               jsonb,

    created_at                       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX fleet_device_health_server_captured_idx
    ON public.fleet_device_health (fleet_server_id, captured_at DESC)
    WHERE fleet_server_id IS NOT NULL;

CREATE INDEX fleet_device_health_org_mesh_captured_idx
    ON public.fleet_device_health (organization_id, mesh_node_id, captured_at DESC);

CREATE INDEX fleet_device_health_org_captured_idx
    ON public.fleet_device_health (organization_id, captured_at DESC);

CREATE INDEX fleet_device_health_hardware_idx
    ON public.fleet_device_health (fleet_device_hardware_id)
    WHERE fleet_device_hardware_id IS NOT NULL;

COMMENT ON TABLE public.fleet_device_health IS
    'Append-only nightly device health snapshot. Insert-only; never updated. Windows-specific fields (bsods_30d, unexpected_shutdowns_30d_count, service_crashes_7d) stay NULL for non-Windows platforms in phase 2.';
COMMENT ON COLUMN public.fleet_device_health.service_crashes_7d IS
    'Top 20 distinct ProcessName values from Application event ID 1000 over 7d, each with crash count, ordered desc. Data-driven: no hardcoded process filter.';

ALTER TABLE public.fleet_device_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view fleet_device_health in their organization"
    ON public.fleet_device_health
    FOR SELECT
    TO public
    USING (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

CREATE POLICY "Users can insert fleet_device_health in their organization"
    ON public.fleet_device_health
    FOR INSERT
    TO public
    WITH CHECK (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

CREATE POLICY "Users can update fleet_device_health in their organization"
    ON public.fleet_device_health
    FOR UPDATE
    TO public
    USING (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

CREATE POLICY "Users can delete fleet_device_health in their organization"
    ON public.fleet_device_health
    FOR DELETE
    TO public
    USING (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

-- Service role bypasses RLS; hub ingest writes via service role. No anon-role policy.

COMMIT;
