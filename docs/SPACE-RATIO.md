# Implicit Peak Detection

## Background

In estimating BPM we sometimes get the case where odd-numbered or unstable peaks are almost completely absent so can't readily be detected by their presence. Instead we introduce a technique that detects their absence.

## Theory

If we consider a number of peaks, denoted by digits from 1 onwards, and troughs denoted by spaces we get the following when all peaks are present:

1 2 3 4 5 6 7 8 9

In the worst case where no odd-numbered peaks are present:

  2   4   6   8

It can easily be seen that the absence of odd-numbered peaks results in larger spaces between the remaining even-numbered peaks.

The same things happens in a real ACF.

We define a metric we term the space ratio. It is defined as the space width divided by the peak width, both measured at the ACF zero crossings for the peaks at T and 2*T. In practice the peak width is often simple to measure but the space may be complicated by intervening minor peaks and general unstable clutter. We therefore note that the total lag between the peak at T and 2T is T so the space width is T - peak width.

The space ratio is then (T - peak width) / peak width.

In the first case of all peaks being present the space ratio tends to 1 but can rise towards 2 due to ACF asymmetry. In the second case the space is enough for two troughs and one peak so tends to be around 3 although it can fall towards 2 with immature peaks that don't need as much space.

## Conclusion

Measuring a space ratio greater than 2 strongly suggests N=2 and div should be doubled prior to calculating bestT.