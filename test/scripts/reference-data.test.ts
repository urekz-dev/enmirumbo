// docs/specs/data-model.md, requirements "The database holds only the
// reference data of the localities it serves (v2)" and "Zones belong to a
// locality, and Tizayuca's come from the SEPOMEX postal catalogue (v2)" and
// "Each zone has its postal code, and Tizayuca's come from the SEPOMEX postal
// catalogue (v2)": the
// data migrations of Tizayuca are the record of where its data came from, so
// they credit their sources, and the one that trims INEGI's catalogue says
// why. What they leave in the database is tested in test/worker/locality.test.ts
// and test/worker/zones.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { checkMigration, MARKER } from "../../scripts/migration-guard.ts";

const migration = (file: string) =>
  readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");

const INEGI =
  "Fuente: INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades";

describe("The database holds only the reference data of the localities it serves (v2)", () => {
  it("the migrations credit INEGI: the catalogue of states and municipalities", () => {
    expect(migration("0003_inegi_catalogue.sql")).toContain(
      `-- ${INEGI}, fecha de corte 2026-06.\n`,
    );
  });

  it("the migrations credit INEGI: the seat of Tizayuca", () => {
    const sql = migration("0009_tizayuca_coordinates.sql");
    expect(sql).toContain(
      `-- ${INEGI}, servicio web wscatgeo v2, localidad 130690001 (periodo 2015-06-01), consultado el 2026-10-14.\n`,
    );
    expect(sql).toContain("-- https://gaia.inegi.org.mx/wscatgeo/v2/localidades/13/069/U\n");
  });

  it("the migration that trims INEGI's catalogue says why, and touches nothing else", () => {
    const sql = migration("0010_tizayuca_only.sql");
    expect(sql).toMatch(/decision of the product owner \(2026-10-14\)/);
    expect(sql).toMatch(new RegExp(`^-- ${MARKER}: \\S`, "m"));
    expect(checkMigration(sql).ok).toBe(true);
    const statements = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((statement) => statement.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    expect(statements.map((statement) => statement.split(" WHERE ")[0])).toEqual([
      'DELETE FROM "municipalities" AS m',
      'DELETE FROM "states" AS s',
    ]);
    // Tizayuca and Hidalgo are never deleted.
    expect(statements[0]).toContain(`m."code" <> '13069'`);
    expect(statements[1]).toContain(`s."code" <> '13'`);
  });
});

describe("Zones belong to a locality, and Tizayuca's come from the SEPOMEX postal catalogue (v2)", () => {
  const sql = migration("0006_tizayuca_zones.sql");

  it("the migration credits SEPOMEX", () => {
    expect(sql).toContain(
      "-- Fuente: Servicio Postal Mexicano (Correos de México), Catálogo Nacional de Códigos Postales, última actualización 2026-10-13.\n",
    );
    expect(sql).toContain(
      "-- https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx\n",
    );
  });

  it("the zones' migration holds no postal code: they ship in their own", () => {
    const values = sql.slice(sql.indexOf("VALUES"));
    // The only five digits are the locality's code.
    expect(new Set(values.match(/[0-9]{5}/g))).toEqual(new Set(["13069"]));
  });
});

describe("Each zone has its postal code, and Tizayuca's come from the SEPOMEX postal catalogue (v2)", () => {
  const sql = migration("0016_zone_postal_codes.sql");

  it("the migration credits SEPOMEX, with the date of the catalogue's last update", () => {
    expect(sql).toContain(
      "-- Fuente: Servicio Postal Mexicano (Correos de México), Catálogo Nacional de Códigos Postales, última actualización 2026-10-17.\n",
    );
    expect(sql).toContain(
      "-- https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx\n",
    );
  });

  it("it names the 105 zones of Tizayuca by slug, each with one postal code, and is additive", () => {
    const pairs = [...sql.matchAll(/\('([a-z0-9-]+)', '([0-9]{5})'\)/g)];
    expect(pairs).toHaveLength(105);
    expect(new Set(pairs.map(([, slug]) => slug)).size).toBe(105);
    expect(pairs.filter(([, , code]) => !code?.startsWith("438"))).toEqual([]);
    expect(sql).toContain(`WHERE "zones"."locality_code" = '13069'`);
    expect(checkMigration(sql)).toEqual({ ok: true, overridden: null });
    expect(sql).not.toContain(MARKER);
  });
});
