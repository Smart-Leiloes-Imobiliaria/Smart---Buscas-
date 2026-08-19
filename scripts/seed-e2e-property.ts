import { closeDatabaseForTests, db } from "@/lib/db";
import { createPropertySearch } from "@/lib/services/property-searches";

const database = await db();
await database.query("DELETE FROM property_searches WHERE city=$1", ["Acrelândia"]);
await database.query(
  `INSERT INTO properties (
    source, source_id, title, description, sale_price, city, state,
    neighborhood, bedrooms, bathrooms, parking_spaces, usable_area,
    property_type, image_url, image_urls, url, country, status
  ) VALUES (
    'E2E', 'collector-property', 'Casa coletada para teste',
    'Registro persistido usado pelo teste ponta a ponta.', 650000,
    'Acrelândia', 'AC', 'Centro', 3, 2, 2, 110, 'HOUSE',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80',
    '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80"]'::jsonb,
    'https://example.com/e2e/collector-property', 'BR', 'ACTIVE'
  )
  ON CONFLICT (source, source_id) DO UPDATE SET
    title=EXCLUDED.title,
    sale_price=EXCLUDED.sale_price,
    city=EXCLUDED.city,
    state=EXCLUDED.state,
    neighborhood=EXCLUDED.neighborhood,
    status='ACTIVE',
    updated_at=CURRENT_TIMESTAMP`,
);
const request = await createPropertySearch({
  city: "Acrelândia",
  state: "AC",
  transaction: "SALE",
  propertyType: "HOUSE",
});
await database.query(
  `INSERT INTO property_search_results(search_id, property_id)
   SELECT $1, id FROM properties WHERE source=$2 AND source_id=$3
   ON CONFLICT DO NOTHING`,
  [request.search.id, "E2E", "collector-property"],
);
await database.query(
  `UPDATE property_searches SET status='COMPLETED', properties_found=1,
   completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
  [request.search.id],
);
await closeDatabaseForTests();
