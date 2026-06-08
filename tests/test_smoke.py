import os
import unittest


class SmokeTest(unittest.TestCase):
    def test_arithmetic(self):
        self.assertEqual(1 + 1, 2)

    def test_readme_exists(self):
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.assertTrue(os.path.isfile(os.path.join(repo_root, "README.md")))


if __name__ == "__main__":
    unittest.main()
