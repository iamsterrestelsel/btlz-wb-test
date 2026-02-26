/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
    await knex.schema.createTable("warehouses", (table) => {
        table.string("warehouse_name").primary();
        table.timestamp("date").defaultTo(knex.fn.now());

        table.string("box_delivery_base");
        table.string("box_delivery_coef_expr");
        table.string("box_delivery_liter");
        table.string("box_delivery_marketplace_base");
        table.string("box_delivery_marketplace_coef_expr");
        table.string("box_delivery_marketplace_liter");
        table.string("box_storage_base");
        table.string("box_storage_coef_expr");
        table.string("box_storage_liter");
    });

    await knex.schema.createTable("wh_tariffs", (table) => {
        table.string("warehouse_name").primary();
        table.timestamp("date").defaultTo(knex.fn.now());

        table.string("dt_next_box");
        table.string("dt_till_max");
    });

    await knex.schema.createTable("wh_location", (table) => {
        table.string("warehouse_name").primary();
        table.string("geo_name");
    });
}

/**
 * @param {import("knex").Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
    await knex.schema.dropTable("wh_tariffs");
    await knex.schema.dropTable("warehouses");
    await knex.schema.dropTable("wh_location");
}
