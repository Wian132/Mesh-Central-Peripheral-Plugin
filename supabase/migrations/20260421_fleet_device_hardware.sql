-- fleet_device_hardware: static per-device hardware inventory, 1:1 with fleet_servers.
-- Upsert key: (organization_id, mesh_node_id). Hub resolves fleet_server_id on upsert.
-- Device-type-neutral (device_type = 'windows_till' today; extensible).
-- RLS mirrors fleet_servers: user_has_product_access('it') AND organization_id = get_user_organization_id().

BEGIN;

CREATE TABLE public.fleet_device_hardware (
    id                    uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       uuid            NOT NULL,
    fleet_server_id       uuid            REFERENCES public.fleet_servers(id) ON DELETE CASCADE,
    mesh_node_id          text            NOT NULL,
    hostname              text            NOT NULL,
    device_type           text            NOT NULL DEFAULT 'windows_till'
                                           CHECK (device_type IN ('windows_till')),

    manufacturer          text,
    model                 text,

    bios_version          text,
    bios_date             timestamptz,

    windows_edition       text,
    windows_version       text,
    windows_build         text,
    windows_architecture  text,
    install_date          timestamptz,

    cpu_model             text,
    cpu_cores             integer,

    total_ram_gb          numeric(6,2),
    dimm_count            integer,
    dimm_sizes_gb         numeric[]       NOT NULL DEFAULT ARRAY[]::numeric[],

    disks                 jsonb           NOT NULL DEFAULT '[]'::jsonb,
    primary_nic_mac       text,

    inventory_hash        text,
    last_seen_at          timestamptz     NOT NULL DEFAULT now(),
    created_at            timestamptz     NOT NULL DEFAULT now(),
    updated_at            timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fleet_device_hardware_org_mesh_unique
        UNIQUE (organization_id, mesh_node_id)
);

CREATE INDEX fleet_device_hardware_org_hostname_idx
    ON public.fleet_device_hardware (organization_id, hostname);

CREATE INDEX fleet_device_hardware_fleet_server_idx
    ON public.fleet_device_hardware (fleet_server_id)
    WHERE fleet_server_id IS NOT NULL;

COMMENT ON TABLE public.fleet_device_hardware IS
    'Static hardware inventory, one row per device. Upsert on (organization_id, mesh_node_id). 1:1 with fleet_servers via fleet_server_id (resolved by hub on upsert). device_type=''windows_till'' today; broaden CHECK when non-Windows platforms come online.';
COMMENT ON COLUMN public.fleet_device_hardware.inventory_hash IS
    'sha256 of the normalized inventory payload; hub skips upsert-set when unchanged.';

ALTER TABLE public.fleet_device_hardware ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view fleet_device_hardware in their organization"
    ON public.fleet_device_hardware
    FOR SELECT
    TO public
    USING (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

CREATE POLICY "Users can insert fleet_device_hardware in their organization"
    ON public.fleet_device_hardware
    FOR INSERT
    TO public
    WITH CHECK (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

CREATE POLICY "Users can update fleet_device_hardware in their organization"
    ON public.fleet_device_hardware
    FOR UPDATE
    TO public
    USING (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

CREATE POLICY "Users can delete fleet_device_hardware in their organization"
    ON public.fleet_device_hardware
    FOR DELETE
    TO public
    USING (
        user_has_product_access('it')
        AND organization_id = get_user_organization_id()
    );

-- Service role bypasses RLS; hub ingest writes via service role. No anon-role policy:
-- plugin never queries this table directly.

COMMIT;
