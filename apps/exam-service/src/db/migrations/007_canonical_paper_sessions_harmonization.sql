-- Migration: 007_canonical_paper_sessions_harmonization.sql
-- Description: Harmonize paper aliases to canonical paper IDs in exam_sessions and wrong_questions
-- Preserves all history, grades, and answers while unifying paper entries

-- 1. 2025-11 Objective (补充试题 -> 标准真题)
UPDATE exam_sessions 
SET paper_id = 'sd-2025-11-objective-538ce18411',
    title = REPLACE(title, '（补充试题）', '')
WHERE paper_id = 'sd-2025-11-objective-ca64ac1a7b';

UPDATE wrong_questions 
SET paper_id = 'sd-2025-11-objective-538ce18411'
WHERE paper_id = 'sd-2025-11-objective-ca64ac1a7b';

-- 2. 2025-05 Objective (补充试题 -> 标准真题)
UPDATE exam_sessions 
SET paper_id = 'sd-2025-05-objective-06b5ee83d9',
    title = REPLACE(title, '（补充试题）', '')
WHERE paper_id = 'sd-2025-05-objective-d3096bb60a';

UPDATE wrong_questions 
SET paper_id = 'sd-2025-05-objective-06b5ee83d9'
WHERE paper_id = 'sd-2025-05-objective-d3096bb60a';

-- 3. 2024-11 Objective (补充索引 -> 标准真题)
UPDATE exam_sessions 
SET paper_id = 'sd-2024-11-objective-096579e82d'
WHERE paper_id = 'sd-2024-11-objective-4f81d3386c';

UPDATE wrong_questions 
SET paper_id = 'sd-2024-11-objective-096579e82d'
WHERE paper_id = 'sd-2024-11-objective-4f81d3386c';

-- 4. Case paper aliases
UPDATE exam_sessions SET paper_id = 'sd-2020-11-case-6cc1a51bb5' WHERE paper_id = 'sd-2020-unknown-case-d1faf9ce88';
UPDATE wrong_questions SET paper_id = 'sd-2020-11-case-6cc1a51bb5' WHERE paper_id = 'sd-2020-unknown-case-d1faf9ce88';

UPDATE exam_sessions SET paper_id = 'sd-2019-05-case-137bfb3b31' WHERE paper_id = 'sd-2019-05-case-f40b76fa80';
UPDATE wrong_questions SET paper_id = 'sd-2019-05-case-137bfb3b31' WHERE paper_id = 'sd-2019-05-case-f40b76fa80';

UPDATE exam_sessions SET paper_id = 'sd-2018-11-case-f64ef3dc89' WHERE paper_id = 'sd-2018-11-case-e1415fdf90';
UPDATE wrong_questions SET paper_id = 'sd-2018-11-case-f64ef3dc89' WHERE paper_id = 'sd-2018-11-case-e1415fdf90';

UPDATE exam_sessions SET paper_id = 'sd-2017-05-case-a174e495a6' WHERE paper_id = 'sd-2017-05-case-e6283cf503';
UPDATE wrong_questions SET paper_id = 'sd-2017-05-case-a174e495a6' WHERE paper_id = 'sd-2017-05-case-e6283cf503';

UPDATE exam_sessions SET paper_id = 'sd-2016-05-case-8e9c988678' WHERE paper_id = 'sd-2016-05-case-caa3234a9b';
UPDATE wrong_questions SET paper_id = 'sd-2016-05-case-8e9c988678' WHERE paper_id = 'sd-2016-05-case-caa3234a9b';
