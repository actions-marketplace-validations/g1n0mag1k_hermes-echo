from setuptools import setup, find_packages

setup(
    name='testcli',
    version='0.1.0',
    packages=find_packages(),
    install_requires=['click', 'pyyaml'],
    entry_points={
        'console_scripts': ['testcli=testcli.cli:main'],
    },
)
