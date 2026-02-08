-- Database Verification Queries for Phase 1.5
-- Run these queries after consolidation to verify results

-- 1. Fact count (should increase)
SELECT COUNT(*) as fact_count FROM sheep_facts;

-- 2. Causal link count (should be >> 17)
SELECT COUNT(*) as causal_count FROM sheep_causal_links;

-- 3. Episode count
SELECT COUNT(*) as episode_count FROM sheep_episodes;

-- 4. Recent consolidation runs (should be SUCCESS)
SELECT id, status, error_message, 
       datetime(started_at) as started,
       datetime(completed_at) as completed,
       sessions_processed,
       episodes_extracted,
       facts_extracted,
       causal_links_extracted
FROM sheep_consolidation_runs 
ORDER BY completed_at DESC 
LIMIT 5;

-- 5. Sample causal links (verify quality)
SELECT cause_description, effect_description, mechanism, confidence 
FROM sheep_causal_links 
ORDER BY confidence DESC 
LIMIT 10;

-- 6. Sample facts (verify no pronouns)
SELECT subject, predicate, object 
FROM sheep_facts 
WHERE is_active = 1
  AND subject NOT LIKE '%he%' 
  AND subject NOT LIKE '%she%'
  AND object NOT LIKE '%he%'
  AND object NOT LIKE '%she%'
LIMIT 20;

-- 7. Causal links by confidence distribution
SELECT 
  CASE 
    WHEN confidence >= 0.9 THEN 'High (0.9+)'
    WHEN confidence >= 0.75 THEN 'Medium (0.75-0.9)'
    WHEN confidence >= 0.5 THEN 'Low (0.5-0.75)'
    ELSE 'Very Low (<0.5)'
  END as confidence_range,
  COUNT(*) as count
FROM sheep_causal_links
GROUP BY confidence_range
ORDER BY MIN(confidence) DESC;

-- 8. Facts with pronouns (should be 0 or very few)
SELECT COUNT(*) as pronoun_facts_count
FROM sheep_facts
WHERE is_active = 1
  AND (
    subject LIKE '% he %' OR subject LIKE '% she %' OR subject LIKE '% it %' OR
    subject LIKE '% they %' OR subject LIKE '% this %' OR subject LIKE '% that %' OR
    object LIKE '% he %' OR object LIKE '% she %' OR object LIKE '% it %' OR
    object LIKE '% they %' OR object LIKE '% this %' OR object LIKE '% that %'
  );
