CREATE TABLE IF NOT EXISTS samples (
    sampleid BIGINT PRIMARY KEY,
    datasetid BIGINT NOT NULL,
    siteid BIGINT,
    sitename TEXT,
    collectionunitid BIGINT,
    collectionunit TEXT,
    handle TEXT,
    datasettype TEXT,
    samplename TEXT,
    depth DOUBLE PRECISION,
    altitude DOUBLE PRECISION,
    geography TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    waterdepth_site DOUBLE PRECISION,
    ph DOUBLE PRECISION,
    ph_units TEXT,
    water_table_depth DOUBLE PRECISION,
    water_table_depth_units TEXT,
    doi TEXT,
    investigators TEXT
);

CREATE INDEX IF NOT EXISTS ix_samples_datasetid ON samples (datasetid);
CREATE INDEX IF NOT EXISTS ix_samples_siteid ON samples (siteid);
CREATE INDEX IF NOT EXISTS ix_samples_ph ON samples (ph);
CREATE INDEX IF NOT EXISTS ix_samples_water_table_depth ON samples (water_table_depth);
CREATE INDEX IF NOT EXISTS ix_samples_sitename_lower ON samples (LOWER(sitename));
CREATE INDEX IF NOT EXISTS ix_samples_latitude ON samples (latitude);
CREATE INDEX IF NOT EXISTS ix_samples_longitude ON samples (longitude);

CREATE TABLE IF NOT EXISTS taxon_abundances (
    observationid BIGSERIAL PRIMARY KEY,
    datasetid BIGINT NOT NULL,
    siteid BIGINT,
    sitename TEXT,
    collectionunitid BIGINT,
    handle TEXT,
    sampleid BIGINT NOT NULL REFERENCES samples(sampleid) ON DELETE CASCADE,
    depth DOUBLE PRECISION,
    taxonid BIGINT,
    taxon_name TEXT NOT NULL,
    abundance DOUBLE PRECISION,
    units TEXT,
    taxongroup TEXT,
    ecologicalgroup TEXT,
    geography TEXT,
    altitude DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS ix_taxon_abundances_sampleid
    ON taxon_abundances (sampleid);
CREATE INDEX IF NOT EXISTS ix_taxon_abundances_taxon_name
    ON taxon_abundances (taxon_name);
CREATE INDEX IF NOT EXISTS ix_taxon_abundances_sample_taxon
    ON taxon_abundances (sampleid, taxon_name);

-- Precomputed using the same rule as build_taxon_profiles(): retain positive
-- observations, normalize each sample to 100%, then combine duplicate names.
CREATE TABLE IF NOT EXISTS sample_taxon_profiles (
    sampleid BIGINT NOT NULL REFERENCES samples(sampleid) ON DELETE CASCADE,
    lumped_taxon TEXT NOT NULL,
    percentage DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (sampleid, lumped_taxon)
);

CREATE INDEX IF NOT EXISTS ix_sample_taxon_profiles_taxon_sample
    ON sample_taxon_profiles (lumped_taxon, sampleid);

CREATE TABLE IF NOT EXISTS publications (
    publicationid BIGINT PRIMARY KEY,
    year INTEGER,
    citation TEXT NOT NULL,
    articletitle TEXT,
    journal TEXT,
    volume TEXT,
    issue TEXT,
    pages TEXT,
    doi TEXT,
    url TEXT
);

CREATE TABLE IF NOT EXISTS dataset_publications (
    datasetid BIGINT NOT NULL,
    publicationid BIGINT NOT NULL REFERENCES publications(publicationid)
        ON DELETE CASCADE,
    primarypub BOOLEAN,
    PRIMARY KEY (datasetid, publicationid)
);

CREATE INDEX IF NOT EXISTS ix_dataset_publications_publicationid
    ON dataset_publications (publicationid);

CREATE TABLE IF NOT EXISTS data_refreshes (
    refreshid BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sample_count INTEGER,
    taxon_observation_count INTEGER,
    publication_count INTEGER,
    notes TEXT
);
