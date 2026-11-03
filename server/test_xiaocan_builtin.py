"""Tests for built-in account tasks."""
import unittest
from unittest import mock

import xiaocan_builtin as builtin


class VipSignTests(unittest.TestCase):
    def test_calls_member_steps_in_order(self):
        with mock.patch.object(builtin, '_call', return_value={}) as call:
            result = builtin.vip_sign({}, {})
        self.assertEqual([args.args[1] for args in call.call_args_list], [
                        'do_user_sign', 'get_user_sign_in_days', 'sign_in_lottery', 'get_sign_in_node',
            'get_vip_up_gift', 'list_vip_gifts', 'get_vip_task',
        ])
        self.assertIn('会员成长礼包完成', result)

    def test_failure_is_reported_after_other_steps(self):
        def call(_account, key, _body):
            if key == 'get_vip_up_gift':
                raise RuntimeError('领取失败')
            return {}
        with mock.patch.object(builtin, '_call', side_effect=call) as invoke:
            with self.assertRaisesRegex(RuntimeError, '会员成长礼包'):
                builtin.vip_sign({}, {})
        self.assertEqual(invoke.call_count, 7)


if __name__ == '__main__':
    unittest.main()
