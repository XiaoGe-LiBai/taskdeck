import os
import tempfile
import unittest
from unittest import mock

import core
import xiaocan_builtin as builtin


class DualRebateSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = (core.DATA_DIR, core.DB_PATH)
        core.close_db()
        core.DATA_DIR = self.temp.name
        core.DB_PATH = os.path.join(self.temp.name, 'panel.db')

    def tearDown(self):
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self.old
        self.temp.cleanup()

    def test_baseline_and_confirm_removal_are_persisted(self):
        account = {'id': 1, 'latitude': '1', 'longitude': '2', 'city_code': '440300'}
        groups = [[{'name': '同店', 'items': []}], [], []]
        with mock.patch.object(builtin.store_watch, 'dual_groups', side_effect=groups), \
             mock.patch.object(builtin.notify, 'notify_async') as notify:
            first = builtin.dual_rebate(account, {'notify_on_initial': False, 'confirm_removal': True})
            second = builtin.dual_rebate(account, {'notify_on_initial': False, 'confirm_removal': True})
            third = builtin.dual_rebate(account, {'notify_on_initial': False, 'confirm_removal': True})
        self.assertIn('首轮基准', first)
        self.assertIn('确认下架 0 家', second)
        self.assertIn('确认下架 1 家', third)
        notify.assert_called_once()


if __name__ == '__main__':
    unittest.main()
