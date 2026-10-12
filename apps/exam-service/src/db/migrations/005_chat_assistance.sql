-- Migration: 005_chat_assistance.sql
-- Description: Adds assistance_used flag to exam_sessions for permanent tracking of AI chat usage in exams

ALTER TABLE exam_sessions ADD COLUMN assistance_used INTEGER NOT NULL DEFAULT 0;
