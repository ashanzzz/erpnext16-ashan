from unittest import TestCase

from ashan_cn_procurement import hooks
from ashan_cn_procurement.boot import PROCUREMENT_PAGE_ROLES


class TestLoginLandingRoute(TestCase):
	def test_root_redirect_and_login_fallback_target_home_workspace(self):
		"""Keep first login on Home instead of Frappe's desktop/App chooser."""
		self.assertIn(
			{
				"source": "/",
				"target": "/desk/Workspaces/Home",
				"redirect_http_status": 302,
			},
			hooks.website_redirects,
		)
		self.assertEqual(
			hooks.add_to_apps_screen[0]["route"],
			"/desk/Workspaces/Home",
		)
		self.assertEqual(
			hooks.role_home_page["System Manager"],
			"desk/Workspaces/Home",
		)

	def test_procurement_workbenches_have_role_focused_navigation(self):
		"""Keep requester, purchaser, receiver and manager entries separated."""
		self.assertIn("Purchase User", PROCUREMENT_PAGE_ROLES["material-request-workbench"])
		self.assertIn("Purchase User", PROCUREMENT_PAGE_ROLES["procurement-execution-workbench"])
		self.assertEqual(
			PROCUREMENT_PAGE_ROLES["material-receipt-workbench"],
			{"Stock Manager", "Stock User"},
		)
