# Frontend cleanup — 2026-10-22

This revision removes dormant sidebar injection scripts, the legacy mission-control Custom HTML fixture, duplicate sidebar JSON sources, and independent legacy salary frontends.

It also stops the app from overriding unrelated ERPNext module sidebars and consolidates sidebar CSS into one stylesheet. Existing business tables and RPC contracts are preserved.

The final UI layer intentionally stays close to ERPNext/Frappe v16: semantic colors, light borders, restrained radii, compact controls, tabular numbers and minimal shadows.
