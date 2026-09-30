import click
import sys
import time
import yaml


@click.group()
def cli():
    pass


@cli.command()
@click.argument('config')
def validate(config):
    """Validate a configuration file."""
    with open(config) as f:
        data = yaml.safe_load(f)
    if 'name' not in data:
        click.echo("Invalid configuration: missing required field 'name'", err=True)
        sys.exit(1)
    click.echo("Valid configuration")


@cli.command()
@click.argument('input')
def convert(input):
    """Convert input file to output format."""
    click.echo("Converted 3 records")


@cli.command()
@click.argument('path')
def inspect(path):
    """Inspect a file and report structure."""
    click.echo("Fields: name, version, region")


@cli.command()
def serve():
    """Start the server."""
    time.sleep(9999)


@cli.group()
def env():
    """Manage environments."""
    pass


@env.command()
def show():
    """Show available environments."""
    click.echo("default")


@env.command()
def create():
    """Create an environment."""
    click.echo("created")


@env.command()
def prune():
    """Prune unused environments."""
    click.echo("pruned")


@env.group()
def deep():
    """Nested group used to verify depth limit."""
    pass


@deep.command('nested')
def deep_nested():
    """Must not be auto-discovered (deeper than one level)."""
    click.echo("too deep")


@cli.group()
def fmt():
    """Format and lint."""
    pass


@fmt.command()
def check():
    """Check formatting without writing."""
    click.echo("ok")


def main():
    cli()
