import unittest
from unittest import mock

import xiaocan_actions as actions


class BestRedpackTests(unittest.TestCase):
    def test_selects_highest_value_available_redpack(self):
        response = {
            'meituan_red_pack': {'red_pack_id': 6, 'reward_num': 300},
            'rep_pack': {'user_red_pack_id': 3, 'reward_num': 100},
            'platform_red_packs': [
                {'user_red_pack_id': 4, 'reward_num': 200},
                {'user_red_pack_id': 5, 'reward_num': 150},
            ],
        }
        with mock.patch.object(actions, '_call', return_value=response):
            self.assertEqual(actions.best_redpack_id({'account_info': '1', 'access_token': 't'}), 6)

    def test_no_available_redpack(self):
        with mock.patch.object(actions, '_call', return_value={'platform_red_packs': []}):
            self.assertIsNone(actions.best_redpack_id({'account_info': '1', 'access_token': 't'}))


if __name__ == '__main__':
    unittest.main()
