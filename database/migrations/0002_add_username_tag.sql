-- add username_tag to credentials so username AES-GCM tag is stored separately
ALTER TABLE credentials ADD COLUMN username_tag bytea;
