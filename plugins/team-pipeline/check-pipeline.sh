#!/bin/bash
claude -p "Read all task files in .agent/tasks/ and display a status summary table grouped by status" --allowedTools "Read,Glob,Grep" --output-format text
