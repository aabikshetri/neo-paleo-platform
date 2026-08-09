-- Run with: psql "$DATABASE_URL" -f scripts/explain_runtime_queries.sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT datasetid, siteid, sitename, sampleid, ph, water_table_depth,
       altitude, latitude, longitude, doi
FROM samples
WHERE ph >= 4.0 AND water_table_depth <= 20
ORDER BY sampleid
LIMIT 250;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT lumped_taxon, AVG(percentage)
FROM sample_taxon_profiles
WHERE sampleid = ANY(ARRAY(SELECT sampleid FROM samples ORDER BY sampleid LIMIT 500))
GROUP BY lumped_taxon
ORDER BY AVG(percentage) DESC;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT p.publicationid, p.citation, COUNT(DISTINCT s.sampleid)
FROM publications p
JOIN dataset_publications dp USING (publicationid)
JOIN samples s ON s.datasetid = dp.datasetid
GROUP BY p.publicationid, p.citation
ORDER BY LOWER(p.citation);
