import os
import psycopg
from psycopg.rows import dict_row
import json


DATABASE_URL = os.getenv("DATABASE_URL")


def get_connection():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL não definida no ambiente."
        )

    return psycopg.connect(
        DATABASE_URL,
        row_factory=dict_row,
    )


def ensure_properties_table():
    sql = """
    CREATE TABLE IF NOT EXISTS properties (
        id BIGSERIAL PRIMARY KEY,

        source TEXT NOT NULL,
        source_id TEXT NOT NULL,

        advertiser_name TEXT,

        title TEXT,
        description TEXT,

        sale_price NUMERIC,
        rental_price NUMERIC,

        city TEXT,
        state TEXT,
        neighborhood TEXT,

        bedrooms INTEGER,
        bathrooms INTEGER,
        suites INTEGER,
        parking_spaces INTEGER,

        usable_area NUMERIC,
        total_area NUMERIC,


        property_type TEXT,

        image_url TEXT,
        url TEXT NOT NULL,

        country TEXT,
        date_posted TIMESTAMPTZ,

        status TEXT NOT NULL DEFAULT 'ACTIVE',

        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE (source, source_id)
    );
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)

        conn.commit()


def upsert_property(property_data):
    sql = """
    INSERT INTO properties (
        source,
        source_id,
        advertiser_name,
        description,
        sale_price,
        city,
        bedrooms,
        usable_area,
        property_type,
        image_url,
        url,
        country,
        date_posted,
        status,
        last_seen_at,
        updated_at
    )
    VALUES (
        %(source)s,
        %(source_id)s,
        %(advertiser_name)s,
        %(description)s,
        %(sale_price)s,
        %(city)s,
        %(bedrooms)s,
        %(usable_area)s,
        %(property_type)s,
        %(image_url)s,
        %(url)s,
        %(country)s,
        %(date_posted)s,
        'ACTIVE',
        NOW(),
        NOW()
    )

    ON CONFLICT (source, source_id)
    DO UPDATE SET
        advertiser_name = EXCLUDED.advertiser_name,
        description = EXCLUDED.description,
        sale_price = EXCLUDED.sale_price,
        city = EXCLUDED.city,
        bedrooms = EXCLUDED.bedrooms,
        usable_area = EXCLUDED.usable_area,
        property_type = EXCLUDED.property_type,
        image_url = EXCLUDED.image_url,
        url = EXCLUDED.url,
        country = EXCLUDED.country,
        date_posted = EXCLUDED.date_posted,
        status = 'ACTIVE',
        last_seen_at = NOW(),
        updated_at = NOW();
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, property_data)

        conn.commit()


def upsert_properties(properties):
    if not properties:
        return 0

    sql = """
    INSERT INTO properties (
        source,
        source_id,
        advertiser_name,
        description,
        sale_price,
        city,
        bedrooms,
        usable_area,
        property_type,
        image_url,
        url,
        country,
        date_posted,
        status,
        last_seen_at,
        updated_at
    )
    VALUES (
        %(source)s,
        %(source_id)s,
        %(advertiser_name)s,
        %(description)s,
        %(sale_price)s,
        %(city)s,
        %(bedrooms)s,
        %(usable_area)s,
        %(property_type)s,
        %(image_url)s,
        %(url)s,
        %(country)s,
        %(date_posted)s,
        'ACTIVE',
        NOW(),
        NOW()
    )

    ON CONFLICT (source, source_id)
    DO UPDATE SET
        advertiser_name = EXCLUDED.advertiser_name,
        description = EXCLUDED.description,
        sale_price = EXCLUDED.sale_price,
        city = EXCLUDED.city,
        bedrooms = EXCLUDED.bedrooms,
        usable_area = EXCLUDED.usable_area,
        property_type = EXCLUDED.property_type,
        image_url = EXCLUDED.image_url,
        url = EXCLUDED.url,
        country = EXCLUDED.country,
        date_posted = EXCLUDED.date_posted,
        status = 'ACTIVE',
        last_seen_at = NOW(),
        updated_at = NOW();
    """

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, properties)

        conn.commit()

    return len(properties)