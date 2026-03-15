CREATE TABLE "counties" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"state" varchar(2) NOT NULL,
	"fips" varchar(10),
	"gis_base_url" text,
	"portal_type" varchar(20),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_id" varchar(50) NOT NULL,
	"layer_name" varchar(200) NOT NULL,
	"layer_type" varchar(50),
	"service_url" text NOT NULL,
	"field_mapping" jsonb,
	"last_synced_at" timestamp,
	"record_count" integer,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "development_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"district_id" uuid NOT NULL,
	"standard_type" varchar(50) NOT NULL,
	"value" numeric,
	"unit" varchar(20),
	"conditions" text
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"municipality_id" varchar(100),
	"district_id" uuid,
	"source_type" varchar(30),
	"chunk_text" text NOT NULL,
	"section_id" varchar(50),
	"source_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_id" varchar(50),
	"layer_name" varchar(200),
	"job_type" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"records_processed" integer DEFAULT 0,
	"records_failed" integer DEFAULT 0,
	"error_log" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "municipalities" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"county_id" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"state" varchar(2) NOT NULL,
	"zoning_source" varchar(20),
	"zoning_url" text,
	"last_scraped_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "parcels_cook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pin" varchar(50) NOT NULL,
	"municipality_id" varchar(100),
	"address" text,
	"owner_name" text,
	"owner_address" text,
	"legal_description" text,
	"land_use_code" varchar(20),
	"zoning_code" varchar(30),
	"assessed_value" numeric,
	"land_value" numeric,
	"building_value" numeric,
	"lot_area_sqft" numeric,
	"building_sqft" numeric,
	"year_built" integer,
	"ownership_type" varchar(20),
	"flood_zone" varchar(30),
	"school_district" varchar(100),
	"geometry" geometry(Geometry, 4326),
	"raw_attributes" jsonb,
	"data_hash" varchar(64),
	"last_updated_at" timestamp,
	CONSTRAINT "parcels_cook_pin_unique" UNIQUE("pin")
);
--> statement-breakpoint
CREATE TABLE "parcels_dupage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pin" varchar(50) NOT NULL,
	"municipality_id" varchar(100),
	"address" text,
	"owner_name" text,
	"owner_address" text,
	"legal_description" text,
	"land_use_code" varchar(20),
	"zoning_code" varchar(30),
	"assessed_value" numeric,
	"land_value" numeric,
	"building_value" numeric,
	"lot_area_sqft" numeric,
	"building_sqft" numeric,
	"year_built" integer,
	"ownership_type" varchar(20),
	"flood_zone" varchar(30),
	"school_district" varchar(100),
	"geometry" geometry(Geometry, 4326),
	"raw_attributes" jsonb,
	"data_hash" varchar(64),
	"last_updated_at" timestamp,
	CONSTRAINT "parcels_dupage_pin_unique" UNIQUE("pin")
);
--> statement-breakpoint
CREATE TABLE "permitted_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"district_id" uuid NOT NULL,
	"use_category" varchar(100),
	"use_description" text NOT NULL,
	"permit_type" varchar(20) NOT NULL,
	"conditions" text
);
--> statement-breakpoint
CREATE TABLE "spatial_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"county_id" varchar(50),
	"layer_id" uuid,
	"layer_type" varchar(50) NOT NULL,
	"feature_id" varchar(100),
	"geometry" geometry(Geometry, 4326) NOT NULL,
	"attributes" jsonb,
	"data_hash" varchar(64),
	"ingested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoning_districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"municipality_id" varchar(100) NOT NULL,
	"district_code" varchar(20) NOT NULL,
	"district_name" text,
	"category" varchar(30),
	"description" text
);
--> statement-breakpoint
ALTER TABLE "data_layers" ADD CONSTRAINT "data_layers_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_standards" ADD CONSTRAINT "development_standards_district_id_zoning_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."zoning_districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_district_id_zoning_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."zoning_districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "municipalities" ADD CONSTRAINT "municipalities_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels_cook" ADD CONSTRAINT "parcels_cook_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcels_dupage" ADD CONSTRAINT "parcels_dupage_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permitted_uses" ADD CONSTRAINT "permitted_uses_district_id_zoning_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."zoning_districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spatial_features" ADD CONSTRAINT "spatial_features_county_id_counties_id_fk" FOREIGN KEY ("county_id") REFERENCES "public"."counties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spatial_features" ADD CONSTRAINT "spatial_features_layer_id_data_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."data_layers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoning_districts" ADD CONSTRAINT "zoning_districts_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dev_standards_district" ON "development_standards" USING btree ("district_id","standard_type");--> statement-breakpoint
CREATE INDEX "idx_parcels_cook_municipality" ON "parcels_cook" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "idx_parcels_cook_zoning" ON "parcels_cook" USING btree ("zoning_code");--> statement-breakpoint
CREATE INDEX "idx_parcels_cook_ownership" ON "parcels_cook" USING btree ("ownership_type");--> statement-breakpoint
CREATE INDEX "idx_parcels_cook_school" ON "parcels_cook" USING btree ("school_district");--> statement-breakpoint
CREATE INDEX "idx_parcels_cook_flood" ON "parcels_cook" USING btree ("flood_zone");--> statement-breakpoint
CREATE INDEX "idx_parcels_cook_values" ON "parcels_cook" USING btree ("assessed_value","lot_area_sqft");--> statement-breakpoint
CREATE INDEX "idx_parcels_cook_composite" ON "parcels_cook" USING btree ("municipality_id","zoning_code","ownership_type");--> statement-breakpoint
CREATE INDEX "idx_parcels_dupage_municipality" ON "parcels_dupage" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "idx_parcels_dupage_zoning" ON "parcels_dupage" USING btree ("zoning_code");--> statement-breakpoint
CREATE INDEX "idx_parcels_dupage_ownership" ON "parcels_dupage" USING btree ("ownership_type");--> statement-breakpoint
CREATE INDEX "idx_parcels_dupage_school" ON "parcels_dupage" USING btree ("school_district");--> statement-breakpoint
CREATE INDEX "idx_parcels_dupage_flood" ON "parcels_dupage" USING btree ("flood_zone");--> statement-breakpoint
CREATE INDEX "idx_parcels_dupage_values" ON "parcels_dupage" USING btree ("assessed_value","lot_area_sqft");--> statement-breakpoint
CREATE INDEX "idx_parcels_dupage_composite" ON "parcels_dupage" USING btree ("municipality_id","zoning_code","ownership_type");--> statement-breakpoint
CREATE INDEX "idx_permitted_uses_district_type" ON "permitted_uses" USING btree ("district_id","permit_type");--> statement-breakpoint
CREATE INDEX "idx_spatial_county_type" ON "spatial_features" USING btree ("county_id","layer_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_zoning_districts_unique" ON "zoning_districts" USING btree ("municipality_id","district_code");