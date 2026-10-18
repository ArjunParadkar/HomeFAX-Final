-- A visitor presenting a share token may read that one share_links row. They
-- already hold the token; this lets the application resolve the link's id and
-- scope under row-level security (access.reach) instead of only through the
-- SECURITY DEFINER app.property_scope().
CREATE POLICY share_links_token_read ON access.share_links FOR SELECT USING (
  app.share_hash() IS NOT NULL AND token_hash = app.share_hash()
  AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
);
