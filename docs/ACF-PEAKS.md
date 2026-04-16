# Autocorrelation Peaks

## Definition

Autocorrelation peaks are the mostly periodic peaks in the autocorrelation function, referred to as the ACF. This ACF is derived from the audio signal.

## Importance

The ACF is used to derive the BPM of the audio, its tempo.

## Use

We noted that the peak which represented the BPM was always the fourth peak in a typical periodicity based on fours. Actually finding the fourth peak can be complicated by the fact that odd-numbered peaks are unstable and may or may not be present. If they are present they may be lower amplitude and malformed in many ways.

The method we use is to identify a series of peaks whose lags take the ratios 1:2:4. This is essentially a progressive doubling of lag which equates to a halving of BPM. We refer to this as harmonic subdivision. Series of peaks which match these ratios score well.

## Octave Errors

The 1:2:4 series has exactly the same ratios as the 2:4:8 series. Without using other information there is no way to distinguish the two cases. Our valid tempo range is defined as 50 BPM to 200 BPM, one 'octave' either side of a 100 BPM midpoint. Because of this two octave range there are always two possible octaves for interpreting BPM.

## Octave Discrimination

We recently managed to clean the array of peaks that we extract from the ACF such that it excludes as much low amplitude high frequency noise as possible. Ideally the remaining major peaks are all periodic and takes the indices 1, 2, 3 etc. In that case the fourth peak simply has the index 4. In practice odd numbered unstable peaks may not be present so the fourth peak may be the second peak with index 2 and we may mistake the eighth peak with index 4 as the fourth peak resulting in an octave error. 

We rely on the fact that once we believe a peak is the fourth we can lock to that lag making us impervious to subsequent peak renumberings as track complexity develops. Typically tracks start with simple rhythms which allows us to quickly and correctly identify the peak with index 4 and lock that BPM value in. We may later find that we have actually locked to the incorrect peak, or that the ACF has changed such that what previously was the fourth peak is no longer so, it might now be the seventh peak in a much different ACF.

We therefore may find we are either an octave too low or an octave too high.

## Unstable Peak Development

For a periodicity based on fours, with the BPM represented by the fourth peak we have the following series with unstable peaks in parentheses.

0 (1) 2 (3) 4 (5) 6 (7) 8 ...

Successively more complicated ACFs develop when the single odd-numbered unstable peaks are replaced with, initially, two separate peaks.

0 (1 2) 3 (4 5) 6 (7 8) 9 (10 11) 12 ...

That leads to a periodicity based on sixes, with the BPM now represented by the sixth peak. This peak is now the second non-zero stable peak.

A further complication develops when the single odd-numbered unstable peaks are replaced with four separate peaks.

0 (1 2 3 4) 5 (6 7 8 9) 10 (11 12 13 14) 15 (16 17 18 19) 20 ...

This leads to a periodicity based on tens, with the BPM now represented by the tenth peak, the second non-zero stable peak. This periodicity is very rare,.

There is another complication when the single odd-numbered unstable peaks are replaced with three separate peaks.

0 (1 2 3) 4 (5 6 7) 8 (9 10 11) 12 (13 15 15) 16 ...

It can be seen that this series is similar to a periodicity based on fours and we have therefore ignored it. Although theoretically possible I don't belive I have ever seen this case, although I have possibly mistaken it for a periodicity based on fours if it really does exist.

## Correcting a half BPM error (octave too low)

We note that half BPM is double lag.

So instead of being on peak 4 (or 6 or 10) we are actually on peak 8 (or 12 or 20).
We detect this by noting the index difference between that lag and half that lag.
This difference is 4 (or 6 or 10) whereas for the correct lag the differences are 2 (or 3 or 5)

We note that there is an overlap, the sets of numbers are not disjoint, so no single threshold can discriminate between all cases. We argue that periodicity based on tens is so rare that we will simply not handle that case correctly.

A threshold of 4 or greater will now indicate a half BPM error which can be corrected by halving lag. This will correct the BPM for periodicities based on fours (by far the most common) and on sixes (less common but not rare).

## Correcting for a double BPM error (octave too high)

We note that double BPM is half lag.

So instead of being on peak 4 (or 6 or 10) we are actually on peak 2 (or 3 or 5).
We detect this by noting the index difference between that lag and half that lag.
This difference is 1 (or 1.5 or 2.5) whereas for the correct lag the differences are 2 (or 3 or 5).

Again there is an overlap, the sets of numbers are not disjoint, so no single threshold can discriminate between all cases. We again argue that peridicity based on tens is so rare that we will simply not handle that case correctly. We then only need to discriminate 1 (or 1.5) from 2 (or 3)

A threshold of 1.5 or less will now indicate a double BPM error which can be corrected by doubling lag. This will correct the BPM for periodicities based on fours (by far the most common) and on sixes (less common but not rare).

## Threshold Conditions

Comparing to the difference between indices of current lag and half lag peaks.
Double BPM if <= 1.5
Half BPM if >= 4

Hence the correct lag will have an index difference greater than 1.5 but less than 4.

## Periodicity based on tens

We don't handle this correctly. Additionally, even if we did have a potential solution we wouldn't be able to test it because periodicities based on tens are so rare.