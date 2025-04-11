#!/bin/sh
# No need to source activate if we call the venv python directly
export FLASK_APP=main
# Use PORT if set, otherwise default to 8080
EFFECTIVE_PORT=${PORT:-8080}
# Explicitly call the python from the virtual environment
./.venv/bin/python -m flask run -p $EFFECTIVE_PORT --debug