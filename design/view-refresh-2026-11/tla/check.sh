#!/bin/bash
# usage: check-view-refresh.sh <tla2tools.jar> [spec-dir ...]
# Runs every *.cfg in each spec dir and writes results/<cfg>.txt next to it.
JAR=$1; shift
cd "$(dirname "$0")"  # specs live next to this script
for d in "${@:-camera-session photos-library notes-view files-browser}"; do for dir in $d; do
  mkdir -p $dir/results
  for c in $dir/*.cfg; do
    n=$(basename $c .cfg)
    (cd $dir && timeout ${T:-600} java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers ${W:-8} -deadlock -config $n.cfg -metadir /tmp/tlc-$$-$n Spec.tla > results/$n.txt 2>&1)
    v=$(grep -m1 -oE "Invariant [A-Za-z]+ is violated|Temporal properties were violated|Model checking completed. No error has been found|Error: .*" $dir/results/$n.txt)
    s=$(grep -m1 -oE "[0-9,]+ distinct states found" $dir/results/$n.txt)
    printf '%-16s %-22s %s (%s)\n' "$dir" "$n" "$v" "$s"
  done
done; done
