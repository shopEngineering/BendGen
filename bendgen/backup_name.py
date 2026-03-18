"""Generate BendControl-compatible backup filenames.

BendControl expects: B<yyMMddHHmm><name>.zip
Example: B2603171136backup31726.zip
"""

from datetime import datetime


def make_backup_filename(name: str = "bendgen") -> str:
    """Generate a filename matching BendControl's backup regex pattern."""
    now = datetime.now()
    date_part = now.strftime("%y%m%d%H%M")
    return f"B{date_part}{name}.zip"
