"""Print the OpenAPI schema without starting a server: ``python -m app.openapi``."""

import json
import sys

from app.main import create_app

if __name__ == "__main__":
    json.dump(create_app().openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
