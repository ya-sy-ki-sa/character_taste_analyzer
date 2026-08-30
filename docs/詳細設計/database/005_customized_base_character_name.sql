-- Separate the canonical/base character name from the customized display name.
-- Existing customized entries used characterName for both purposes, so the
-- migration preserves their behaviour by copying that value.

UPDATE entry_revisions
SET registration_payload_json = json_set(
  registration_payload_json,
  '$.baseCharacterName',
  json_extract(registration_payload_json, '$.characterName')
)
WHERE json_extract(registration_payload_json, '$.registrationType') = 'customized_existing'
  AND (
    json_type(registration_payload_json, '$.baseCharacterName') IS NULL
    OR trim(COALESCE(json_extract(registration_payload_json, '$.baseCharacterName'), '')) = ''
  );

UPDATE user_character_entries
SET draft_payload_json = json_set(
  draft_payload_json,
  '$.baseCharacterName',
  json_extract(draft_payload_json, '$.characterName')
)
WHERE registration_type = 'customized_existing'
  AND (
    json_type(draft_payload_json, '$.baseCharacterName') IS NULL
    OR trim(COALESCE(json_extract(draft_payload_json, '$.baseCharacterName'), '')) = ''
  );
