# Copyright (c) 2026, Ashan and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import date_diff

class AshanHolidayScheduleConfig(Document):
	def validate(self):
		if self.start_date and self.end_date:
			self.days_count = date_diff(self.end_date, self.start_date) + 1
